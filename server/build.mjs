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
  '_headers',        // 보안 헤더. Workers Static Assets 가 읽는다 (Worker 코드로는 못 붙인다)
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
// 사용자 승인 공개 시안 하나만 포함한다. docs/ 전체를 공개하지 않는다.
await cp(join(ROOT, 'docs/balance/core-circuit-draft-2026-09-23.html'), join(DIST, 'core-circuit-preview.html'));
console.log('  복사: core-circuit-preview.html (계정 저장 없는 미리보기)');
// 2026-10-08 사용자 승인: 공격 시범 HTML만 공개. 내부 기록/생성 원본은 제외.
const MOTION_PREVIEWS = ['attack-motion-preview.html', 'attack-motion-review.html', 'azure-dagger-sequence-preview.html'];
await mkdir(join(DIST, 'docs/art'), { recursive: true });
for (const name of MOTION_PREVIEWS) {
  await cp(join(ROOT, 'docs/art', name), join(DIST, 'docs/art', name));
  console.log(`  복사: docs/art/${name} (독립 시범 · 실전 미연결)`);
}
console.log(`\ndist/ 준비 완료 — ${n + 1 + MOTION_PREVIEWS.length}개 항목. 이제 npx wrangler dev 또는 npx wrangler deploy`);
