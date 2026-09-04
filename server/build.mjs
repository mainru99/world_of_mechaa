/* 배포용 dist/ 만들기 — 클라이언트 파일만 모은다.
 *
 * 리포 루트를 그대로 assets.directory 로 지정하면 server/schema.sql 이나
 * CONTRACT.md 같은 내부 문서까지 공개된다. 그래서 올릴 것만 골라 복사한다.
 *
 *   node server/build.mjs
 *
 * 빌드라고 부르지만 하는 일은 복사뿐이다. 번들러도 의존성도 쓰지 않는다 —
 * 이 게임이 순수 정적 웹인 걸 그대로 유지하기 위해서다.
 */
import { cp, rm, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* 올릴 것 — 여기에 없는 건 배포되지 않는다. 파일을 추가하면 이 목록도 고칠 것. */
const INCLUDE = [
  'index.html',
  'style.css',
  'js',
  'data',
  'assets',
  'themes',
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

let n = 0;
for (const name of INCLUDE) {
  const from = join(ROOT, name);
  try {
    await stat(from);
  } catch {
    console.warn(`  건너뜀 (없음): ${name}`);
    continue;
  }
  await cp(from, join(DIST, name), { recursive: true });
  n++;
  console.log(`  복사: ${name}`);
}
console.log(`\ndist/ 준비 완료 — ${n}개 항목. 이제 npx wrangler dev 또는 npx wrangler deploy`);
