/* ROWAR 서버 — Cloudflare Worker 진입점
 *
 * 라우팅은 wrangler.jsonc 가 절반을 맡는다.
 *   · 요청 경로에 맞는 정적 파일이 dist/ 에 있으면 → Worker 를 타지 않고 바로 나간다
 *   · run_worker_first 에 적은 /api/* 는 → 정적 파일보다 이 코드가 먼저 본다
 *   · 그 외에 정적 파일이 없는 경로 → 이 코드로 넘어온다
 *
 * 그래서 여기서는 /api/* 만 처리하고, 나머지는 자산 쪽으로 돌려보낸다.
 *
 * 아직 게임 로직은 없다. 지금은 배포 파이프라인이 끝까지 도는지 확인하는 뼈대다.
 * 다음 단계(익명 계정 → 상태 동기화 → 서버 판정)는 server/SETUP_KO.md 9절 참고.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/* D1 바인딩이 실제로 붙었는지까지 확인한다.
   설정만 맞고 DB 가 비어 있는 경우를 배포 후에 바로 알아채려는 것이다. */
async function health(env) {
  const started = Date.now();
  try {
    const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?1').bind('schema_version').first();
    const tables = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf%' AND name NOT LIKE 'sqlite_%'")
      .first();
    return json({
      ok: true,
      db: 'connected',
      schema_version: row?.v ?? null,
      tables: tables?.n ?? 0,
      ms: Date.now() - started,
    });
  } catch (e) {
    // 바인딩이 없거나 스키마가 안 올라간 경우. 원인을 그대로 보여준다.
    return json({ ok: false, db: 'error', error: String(e && e.message || e) }, 500);
  }
}

async function handleApi(request, env, url) {
  const path = url.pathname.slice('/api'.length) || '/';

  if (path === '/health') return health(env);

  return json({ ok: false, error: 'not found', path: url.pathname }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        // 예외를 그대로 흘리면 Cloudflare 기본 오류 페이지가 나온다. JSON 으로 돌려준다.
        return json({ ok: false, error: String(e && e.message || e) }, 500);
      }
    }

    // 정적 파일. 여기까지 왔다는 건 dist/ 에 없는 경로라는 뜻이라 대개 404 가 된다.
    return env.ASSETS.fetch(request);
  },
};
