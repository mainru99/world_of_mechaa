/* 읽기 묶음 — 서로 기다릴 필요 없는 SELECT 여럿을 D1 에 **한 번에** 보낸다. (2026-10-08 · 사용자 지시 '서버가 느리다')
 *
 * 운영은 Worker 가 LAX, D1 이 APAC 에 있어 한 번 오갈 때마다 ~115ms 다(STATUS 2026-09-25 (7)).
 * 그래서 응답 시간은 거의 '왕복 횟수 × 115ms' 다. 플레이어 행 · 기체 · 파츠처럼 늘 같이 읽는 것을 따로 세 번
 * 물으면 345ms, 묶으면 115ms 다. `node tools/dbtrips.mjs` 가 API 마다 왕복을 센다.
 *
 * **읽기만 넣는다.** batch 는 트랜잭션이라 쓰기를 섞어도 되지만, 쓰기는 각 자리에서 조건(낙관적 잠금 ·
 * changes() 확인)을 따로 보므로 섞지 않는다.
 *
 * 테스트 도구의 흉내 DB(tools/*.mjs)는 batch 가 행을 돌려주지 않는 것이 많다 — 그때는 하나씩 다시 읽는다.
 * 실제 D1 은 batch 결과마다 results 를 준다. 읽기라 두 번 돌아도 해가 없다. */
export async function readMany(env, stmts) {
  if (typeof env.DB.batch === 'function') {
    const rs = await env.DB.batch(stmts);
    if (Array.isArray(rs) && rs.length === stmts.length && rs.every(r => r && Array.isArray(r.results))) return rs.map(r => r.results);
  }
  const out = [];
  for (const s of stmts) out.push(((await s.all()) || {}).results || []);
  return out;
}

/* 한 행만 필요한 읽기 결과에서 첫 행(없으면 null) */
export const firstOf = rows => (rows && rows.length ? rows[0] : null);

/* 응답 뒤로 미루기 — 결과를 기다릴 필요 없는 정리(아레나 방어 스냅샷 재등록 등)를 응답을 보낸 뒤에 돌린다.
 * work 는 함수다(바로 시작하지 않게). Worker 의 fetch 가 env.__defer(= ctx.waitUntil)를 붙여 준다. 없으면(검사 도구) 지금 기다린다 — 동작은 같고 순서만 다르다.
 * 실패해도 사용자 응답은 이미 나갔다 — 기록만 남긴다(아레나는 다음 갱신 · 30분 크론이 다시 맞춘다). */
export function later(env, work) {
  if (env && typeof env.__defer === 'function') {
    /* 응답이 나간 뒤에 시작한다(setTimeout 0) — 그 전에 시작하면 응답 직전의 D1 왕복과 겹친다 */
    env.__defer(new Promise(r => setTimeout(r, 0)).then(work).catch(e => console.log('later failed', String(e && e.message || e))));
    return undefined;
  }
  return work();
}
