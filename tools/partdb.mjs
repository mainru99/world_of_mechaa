/* 7단계 검증 — 파츠가 **진짜 D1 을 한 바퀴 돌고도** 같은 물건인가.
 *
 * 여기서 깨지면 화면에서는 안 보이고 저장할 때만 조용히 망가진다. 그래서
 * 흉내 낸 DB 가 아니라 로컬 D1 에 실제로 넣었다 뺀다.
 *
 * 보는 것 셋.
 *   ① 칸 순서   — insertPart 의 바인드 순서와 표의 칸이 어긋나면 값이 옆칸에 들어간다.
 *                 컬럼을 늘릴 때 제일 흔하게 나는 사고다.
 *   ② 값        — 넣기 전 파츠와 꺼낸 파츠의 **스탯이 완전히 같아야** 한다.
 *                 스탯을 저장하지 않으므로, 이게 맞아야 '서버가 다시 만든다'가 성립한다.
 *   ③ 위조      — 정당하지 않은 조합을 checkNewPart 가 버리는가.
 *                 예전 방식(상한으로 자르기)은 상한 밑으로 꽉 채운 파츠를 통과시켰다.
 *
 * node tools/partdb.mjs        로컬 D1 에 임시 계정을 만들고 쓴 뒤 지운다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PART_BASES, CONST } from '../data/balance.js';
import { rollPart } from '../js/gacha.js';
import { partStat, partMods } from '../js/stats.js';
import { mulberry32 } from '../js/sim.js';
import { PART_COLS, partOf, insertPart, updatePart, partChanged, checkNewPart } from '../server/parts.js';

const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const G = s => '\x1b[32m' + s + '\x1b[0m', R = s => '\x1b[31m' + s + '\x1b[0m';
let fail = 0;
const is = (c, m) => { console.log('  ' + (c ? G('✓') : R('✗')) + ' ' + m); if (!c) fail++; };

function d1(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'rowar-'));
  try {
    const f = join(dir, 'q.sql');
    writeFileSync(f, sql, 'utf8');
    const out = execFileSync(process.execPath,
      [WRANGLER, 'd1', 'execute', 'rowar', '--local', '--json', '--file', f],
      { encoding: 'utf8', maxBuffer: 32 << 20 });
    const i = out.indexOf('[');
    if (i < 0) throw new Error('JSON 을 못 찾았다:\n' + out.slice(0, 400));
    return JSON.parse(out.slice(i));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* insertPart/updatePart 는 D1 의 prepare().bind() 를 부른다. 그 호출을 받아 적어서
   진짜 SQL 문자열로 굳힌다 — **바인드 순서를 그대로 시험하려고** 이렇게 한다.
   여기서 SQL 을 손으로 다시 쓰면 정작 어긋날 수 있는 그 부분을 안 보게 된다. */
const lit = v => v == null ? 'NULL'
  : typeof v === 'number' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
const fakeD1 = {
  prepare: sql => ({
    bind: (...args) => sql.replace(/\?(\d+)/g, (_, n) => lit(args[+n - 1])),
  }),
};

const ACC = -777;                       // 사람이 쓸 수 없는 음수 id — 진짜 계정과 안 섞인다
const cleanup = () => d1(`DELETE FROM part WHERE account_id = ${ACC};
DELETE FROM account WHERE id = ${ACC};`);

console.log('\n로컬 D1 준비');
cleanup();
d1(`INSERT INTO account (id, login_id, pw_hash, created_at, last_seen)
    VALUES (${ACC}, 'partdb-test', 'x', 0, 0);`);
is(true, `임시 계정 ${ACC} 을 만들었다`);

/* ── ① · ② 넣었다 빼기 ───────────────────────────────────── */
console.log('\n① · ② D1 왕복');
const rnd = mulberry32(31337);
const made = [];
for (const rar of ['C', 'R', 'SR', 'SSR'])
  for (const slot of ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'])
    for (let i = 0; i < 4; i++)
      made.push(rollPart(20 + i * 9, rnd, `t-${rar}-${slot}-${i}`, rar, slot));
/* 강화도 섞는다 — enh 는 베이스의 좋은 값만 키우므로 왕복에서 틀어지기 쉽다 */
made.forEach((p, i) => { p.enh = i % 11; });

d1(made.map(p => insertPart(fakeD1, ACC, p, 0) + ';').join('\n'));
const rows = d1(`SELECT ${PART_COLS} FROM part WHERE account_id = ${ACC} ORDER BY id`)[0].results;
is(rows.length === made.length, `${made.length}개를 넣고 ${rows.length}개를 꺼냈다`);

const key = o => JSON.stringify(Object.keys(o).sort().map(k => [k, Math.round(o[k] * 1e9)]));
const byUid = new Map(rows.map(r => [r.uid, partOf(r)]));
let colBad = 0, statBad = 0, modBad = 0, shapeBad = 0;
for (const p of made) {
  const q = byUid.get(p.uid);
  if (!q) { colBad++; continue; }
  if (q.base !== p.base || q.slot !== p.slot || q.rarity !== p.rarity ||
      q.lv !== p.lv || q.seed !== (p.seed >>> 0) || q.enh !== p.enh) colBad++;
  if (q.stats !== undefined || !Array.isArray(q.affixes)) shapeBad++;
  if (key(partStat(q)) !== key(partStat(p))) statBad++;
  const a = partMods(p), b = partMods(q);
  if (a.range !== b.range || key(a.fx) !== key(b.fx)) modBad++;
}
is(!colBad,   `칸이 안 밀렸다 (base·slot·rarity·lv·seed·enh)${colBad ? ` — ${colBad}건` : ''}`);
is(!shapeBad, `꺼낸 것이 새 모양이다 (stats 없음 · affixes 배열)${shapeBad ? ` — ${shapeBad}건` : ''}`);
is(!statBad,  `스탯이 완전히 같다${statBad ? ` — ${statBad}건` : ''}`);
is(!modBad,   `구간 배수·고유 효과도 같다${modBad ? ` — ${modBad}건` : ''}`);

/* 옛 파츠도 같은 길로 들어가야 한다 — 이관 창구가 아직 그 모양을 보낸다 */
const oldPart = { uid: 't-old', slot: 'WEAPON', name: '레일건', rarity: 'R',
                  stats: { atk: 12, spd: 3 }, enh: 2 };
d1(insertPart(fakeD1, ACC, oldPart, 0) + ';');
{
  const r = d1(`SELECT ${PART_COLS} FROM part WHERE account_id = ${ACC} AND uid = 't-old'`)[0].results[0];
  const q = partOf(r);
  is(!q.base && key(partStat(q)) === key(partStat(oldPart)), '옛 모양 파츠도 그대로 왕복한다');
}

/* ── 달라졌는지 판정 ─────────────────────────────────────── */
console.log('\n③ 동기화가 UPDATE 를 언제 거나');
{
  const r = rows[0], p = made.find(x => x.uid === r.uid);
  is(!partChanged(r, p), '안 바뀐 파츠에는 UPDATE 를 안 건다');
  is(partChanged(r, { ...p, enh: p.enh + 1 }), '강화가 오르면 건다');
  is(partChanged(r, { ...p, seed: (p.seed ^ 1) >>> 0 }), '씨앗이 바뀌면 건다');
  is(partChanged(r, { ...p, affixes: [] }), '인챈트가 바뀌면 건다');
  d1(updatePart(fakeD1, r.id, { ...p, enh: 10 }) + ';');
  const r2 = d1(`SELECT ${PART_COLS} FROM part WHERE id = ${r.id}`)[0].results[0];
  is(partOf(r2).enh === 10 && partOf(r2).base === p.base, 'UPDATE 가 강화만 바꾸고 나머지를 지키다');
}

/* ── ④ 위조 ──────────────────────────────────────────────── */
console.log('\n④ 위조 — 정당하지 않은 조합은 버린다');
{
  const ok = rollPart(30, mulberry32(9), 'v', 'SR', 'WEAPON');
  const ko = (label, mut) => is(checkNewPart({ ...ok, ...mut }) === null, label);
  is(checkNewPart(ok) !== null, '정상 파츠는 통과한다');
  ko('모르는 베이스',            { base: 'superSword' });
  ko('슬롯이 베이스와 안 맞음',   { slot: 'CORE' });
  ko('모르는 등급',              { rarity: 'UR' });
  ko('등급이 못 내는 티어',       { affixes: [{ id: 'highSpeed', tier: 'IV' }, { id: 'keen', tier: 'IV' }], rarity: 'C' });
  ko('모르는 인챈트',            { affixes: [{ id: 'godMode', tier: 'I' }, { id: 'keen', tier: 'II' }] });
  ko('같은 인챈트 두 번',         { affixes: [{ id: 'keen', tier: 'II' }, { id: 'keen', tier: 'II' }] });
  ko('같은 그룹 두 번',          { affixes: [{ id: 'heavy', tier: 'II' }, { id: 'light', tier: 'II' }] });
  ko('못 붙는 슬롯의 인챈트',     { affixes: [{ id: 'retro', tier: 'II' }, { id: 'keen', tier: 'II' }] });
  ko('등급보다 인챈트가 많음',    { affixes: [{ id: 'keen', tier: 'II' }, { id: 'heavy', tier: 'II' }, { id: 'piercing', tier: 'II' }] });
  ko('인챈트가 모자람',          { affixes: [] });
  /* 예전 방식은 '자르기' 라 여기서 통과했다 — 자른 값이 곧 최대치이기 때문이다 */
  const huge = checkNewPart({ ...ok, lv: 99999, enh: 99, name: '<img src=x onerror=alert(1)>' });
  is(huge && huge.lv === CONST.MAXLV && huge.enh === 10, `레벨·강화는 상한까지만 (lv ${huge && huge.lv} · enh ${huge && huge.enh})`);
  is(huge && huge.name === PART_BASES[ok.base].ko, '이름은 클라가 보낸 것을 안 쓰고 베이스에서 다시 만든다');
}

console.log('\n정리');
cleanup();
const left = d1(`SELECT COUNT(*) n FROM part WHERE account_id = ${ACC}`)[0].results[0].n;
is(left === 0, '임시 데이터를 전부 지웠다');

console.log(fail ? '\n' + R('✗ ' + fail + '건 실패') : '\n' + G('전부 통과'));
process.exitCode = fail ? 1 : 0;
