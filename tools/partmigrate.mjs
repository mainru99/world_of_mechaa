/* 옛 파츠에 인챈트를 붙이는 SQL 을 만든다 (파츠 개편 7단계).
 *
 *   node tools/partmigrate.mjs            로컬 DB 를 읽는다
 *   node tools/partmigrate.mjs --remote   운영 DB 를 읽는다
 *
 * 013_part_base.sql 이 칸을 만들고 base·lv·seed 까지 채운다. **인챈트만 남는다.**
 * 그것을 SQL 로 굴리지 않는 이유 — 슬롯 제약(`slots`)·그룹 배제(`AFFIX_GROUPS`)·
 * 등급별 티어 분포(`RARITY[].tiers`)를 다 봐야 해서, SQL 로 옮겨 적으면 규칙이
 * 두 벌이 된다. 한쪽만 고쳐지는 날이 반드시 온다.
 * 그래서 게임과 **같은 함수**(`rollAffixes`)로 뽑고, 결과만 SQL 로 내보낸다.
 *
 * seed 에서 뽑으므로 **몇 번을 돌려도 같은 SQL 이 나온다.** 미리 읽어 보고
 * 적용할 수 있고, 중간에 끊겨도 다시 돌리면 된다.
 *
 * 왜 인챈트를 새로 굴리나 — 옛 파츠에는 인챈트라는 개념 자체가 없었다.
 * 빈 채로 두면 '인챈트 없는 구형' 이 되어 명백한 하위호환이 된다(DESIGN.md §6).
 *
 * 내보낸 뒤:
 *   node tools/partmigrate.mjs > .tmp/affixes.sql
 *   npx wrangler d1 execute rowar --local --file=.tmp/affixes.sql
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RARITY } from '../data/balance.js';
import { rollAffixes } from '../js/gacha.js';
import { mulberry32 } from '../js/sim.js';

const REMOTE = process.argv.includes('--remote');
const WHERE = 'base IS NOT NULL AND affixes IS NULL';
const RAR_BY = Object.fromEntries(RARITY.map(r => [r.k, r]));
/* wrangler 를 npx 로 부르지 않고 **노드로 직접** 부른다.
   - shell:true 로 npx 를 부르면 인자가 이스케이프 없이 이어붙는다(Node 가 경고한다)
   - shell 없이 npx.cmd 를 부르면 요즘 Node 가 .cmd 실행을 막아 EINVAL 이 난다
   둘 다 피하려면 실제 진입점을 노드에 넘기는 것이 제일 깔끔하다. */
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

/* SQL 을 임시 파일로 넘긴다. --command 로 넘기면 윈도의 셸 따옴표 규칙에 걸려
   문장이 토막 난다 (실제로 "Unknown arguments: id,, slot,, ..." 로 깨졌다). */
function query(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'rowar-'));
  const file = join(dir, 'q.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'rowar',
      REMOTE ? '--remote' : '--local', '--json', '--file', file],
      { encoding: 'utf8', maxBuffer: 32 << 20 });
    /* wrangler 가 JSON 앞에 배너를 끼워 넣는 판이 있어서 첫 '[' 부터 자른다 */
    const i = out.indexOf('[');
    if (i < 0) throw new Error('wrangler 응답에서 JSON 을 못 찾았다:\n' + out.slice(0, 400));
    return JSON.parse(out.slice(i))[0].results;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const rows = query(`SELECT id, slot, rarity, base, seed FROM part WHERE ${WHERE} ORDER BY id`);

if (!rows.length) {
  console.error(`옮길 파츠가 없다 (${REMOTE ? '운영' : '로컬'}). 이미 끝났거나 013 을 아직 안 돌렸다.`);
  process.exit(0);
}

const lines = [], tally = {};
for (const r of rows) {
  const rar = RAR_BY[r.rarity];
  if (!rar) { console.error(`  ! id=${r.id} 등급 '${r.rarity}' 을 모른다 — 건너뛴다`); continue; }
  if (r.seed == null) { console.error(`  ! id=${r.id} seed 가 비었다 — 013 을 먼저 돌린다`); process.exit(1); }
  const affixes = rollAffixes(r.slot, rar, mulberry32(r.seed >>> 0));
  tally[affixes.length] = (tally[affixes.length] || 0) + 1;
  /* JSON 안에 작은따옴표가 들어갈 수 없는 값들이지만(인챈트 id 는 영문), 그래도 이스케이프한다 */
  const json = JSON.stringify(affixes).replace(/'/g, "''");
  lines.push(`UPDATE part SET affixes = '${json}' WHERE id = ${r.id} AND ${WHERE};`);
}

console.error(`${REMOTE ? '운영' : '로컬'} 파츠 ${rows.length}개 · 인챈트 개수 ` +
  Object.keys(tally).sort().map(k => `${k}개 ${tally[k]}건`).join(' · '));

console.log(`-- 옛 파츠에 인챈트를 붙인다 (tools/partmigrate.mjs 가 만들었다).`);
console.log(`-- 대상 ${rows.length}개 · ${REMOTE ? '운영' : '로컬'} DB 기준 · seed 에서 뽑았으므로 다시 만들어도 같다.`);
console.log(lines.join('\n'));
