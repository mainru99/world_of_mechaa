/* ROWAR 서버 — Cloudflare Worker 진입점
 *
 * 라우팅은 wrangler.jsonc 가 절반을 맡는다.
 *   · 요청 경로에 맞는 정적 파일이 dist/ 에 있으면 → Worker 를 타지 않고 바로 나간다
 *   · run_worker_first 에 적은 /api/* 는 → 정적 파일보다 이 코드가 먼저 본다
 *   · 그 외에 정적 파일이 없는 경로 → 이 코드로 넘어온다
 *
 * 지금 단계: 게스트(익명) 계정까지. 회원가입을 강요하지 않고 바로 놀게 한다.
 * 게임 진행 판정은 아직 클라가 한다 — 서버는 계정과 상태 보관만 맡는다.
 * 다음 단계는 server/SETUP_KO.md 9절 참고.
 */
import { ROBOT_TYPES } from '../data/balance.js';
import { sanitize, loadState, saveState } from './state.js';
import { serverPull } from './pull.js';
import { findMatch, startBattle } from './battle.js';
import { hangarAction } from './hangar.js';
import { registerArena, balanceVersion } from './arena.js';
import { hashPassword, verifyPassword, checkCredentials } from './auth.js';

/* 시작 기체는 커먼에서 하나. 클라의 freshState() 와 같은 규칙이다.
   시작 재화(크레딧 600·코어 12·스크랩 30)는 schema.sql 의 DEFAULT 에 있다 —
   두 군데 적어 두면 반드시 어긋나므로 여기서는 넘기지 않는다. */
const COMMON_IDS = Object.values(ROBOT_TYPES).filter(r => r.rarity === 'C').map(r => r.id);

const SESSION_DAYS = 90;
const DAY_MS = 86400000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const hex = n => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};

/* device_key 는 클라가 만들어 보내는 값이라 그대로 믿지 않는다.
   UUID 든 hex 든 상관없지만 길이와 문자만 제한한다. */
const okDeviceKey = k => typeof k === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(k);

const pick = a => a[Math.floor(Math.random() * a.length)];

/* ── 인증 ──────────────────────────────────────────────── */

/* Authorization: Bearer <token> 을 세션 한 행으로 바꾼다. 만료면 null. */
async function auth(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+([0-9a-f]{32,128})$/i);
  if (!m) return null;
  const row = await env.DB
    .prepare(`SELECT s.token, s.account_id, s.expires_at, a.status
                FROM session s JOIN account a ON a.id = s.account_id
               WHERE s.token = ?1`)
    .bind(m[1]).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  if (row.status !== 'active') return null;
  return row;
}

async function newSession(env, accountId, now) {
  const token = hex(32);
  await env.DB.prepare('INSERT INTO session (token, account_id, created_at, expires_at) VALUES (?1,?2,?3,?4)')
    .bind(token, accountId, now, now + SESSION_DAYS * DAY_MS).run();
  return { token, expires_at: now + SESSION_DAYS * DAY_MS };
}

/* 게스트 로그인.
   같은 device_key 로 다시 오면 기존 계정을 그대로 쓴다(브라우저를 껐다 켠 경우).
   처음이면 계정·진행상태·시작 기체를 한 번에 만든다. */
async function guestLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const key = body && body.device_key;
  if (!okDeviceKey(key)) return json({ ok: false, error: 'bad device_key' }, 400);

  const now = Date.now();
  const found = await env.DB.prepare('SELECT id, status FROM account WHERE device_key = ?1').bind(key).first();

  if (found) {
    if (found.status !== 'active') return json({ ok: false, error: 'account disabled' }, 403);
    await env.DB.prepare('UPDATE account SET last_seen = ?1 WHERE id = ?2').bind(now, found.id).run();
    const s = await newSession(env, found.id, now);
    return json({ ok: true, isNew: false, account_id: found.id, ...s });
  }

  /* 새 계정. account → player → robot 순서로 만들고 sel_robot 을 채운다.
     D1 은 문장 단위 실행이라 중간에 끊기면 반쪽이 남을 수 있다. 그래서 마지막에
     검증하고, 실패하면 다음 로그인 때 이어서 채우도록 만들었다(아래 ensureStarter). */
  const ins = await env.DB
    .prepare('INSERT INTO account (device_key, created_at, last_seen) VALUES (?1,?2,?2)')
    .bind(key, now).run();
  const accountId = ins.meta.last_row_id;

  await env.DB.prepare('INSERT INTO player (account_id, nickname, updated_at) VALUES (?1,?2,?3)')
    .bind(accountId, 'GUEST-' + String(accountId).padStart(4, '0'), now).run();

  await ensureStarter(env, accountId, now);
  await registerArena(env, accountId, now);   // 만들어지자마자 남의 상대가 될 수 있게

  const s = await newSession(env, accountId, now);
  return json({ ok: true, isNew: true, account_id: accountId, ...s });
}

/* 기체가 하나도 없으면 시작 기체를 만들어 준다.
   계정 생성이 중간에 끊긴 경우를 다음 접속 때 스스로 복구한다. */
async function ensureStarter(env, accountId, now) {
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM robot WHERE account_id = ?1').bind(accountId).first();
  if (cnt && cnt.n > 0) return;
  const type = pick(COMMON_IDS);
  const r = await env.DB
    .prepare('INSERT INTO robot (account_id, type, level, exp, fat, fat_at, created_at) VALUES (?1,?2,1,0,0,?3,?3)')
    .bind(accountId, type, now).run();
  await env.DB.prepare('UPDATE player SET sel_robot = ?1, updated_at = ?2 WHERE account_id = ?3')
    .bind(r.meta.last_row_id, now, accountId).run();
}

/* 현재 계정 상태. 클라가 서버 상태를 확인하는 용도. */
async function me(env, sess) {
  const now = Date.now();
  await ensureStarter(env, sess.account_id, now);   // 반쪽 계정 자가 복구

  const player = await env.DB
    .prepare(`SELECT nickname, credits, cores, scrap, wins, losses, pulls, rating, rank_cached, sel_robot
                FROM player WHERE account_id = ?1`)
    .bind(sess.account_id).first();
  const robots = await env.DB
    .prepare('SELECT id, type, level, exp, fat, fat_at FROM robot WHERE account_id = ?1 ORDER BY id')
    .bind(sess.account_id).all();

  const acc = await env.DB.prepare('SELECT login_id FROM account WHERE id = ?1').bind(sess.account_id).first();

  return json({
    ok: true,
    account_id: sess.account_id,
    guest: !(acc && acc.login_id),
    login_id: (acc && acc.login_id) || null,
    player,
    robots: robots.results || [],
    server_now: now,                   // 피로도 회복은 서버 시각 기준이어야 한다
  });
}

/* ── 상태 확인 ─────────────────────────────────────────── */
async function health(env) {
  const started = Date.now();
  try {
    const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?1').bind('schema_version').first();
    const tables = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf%' AND name NOT LIKE 'sqlite_%'")
      .first();
    const accounts = await env.DB.prepare('SELECT COUNT(*) AS n FROM account').first();
    return json({
      ok: true, db: 'connected',
      schema_version: row?.v ?? null,
      tables: tables?.n ?? 0,
      accounts: accounts?.n ?? 0,
      arena: (await env.DB.prepare('SELECT COUNT(*) AS n FROM arena_entry').first())?.n ?? 0,
      balance_ver: balanceVersion(),
      ms: Date.now() - started,
    });
  } catch (e) {
    return json({ ok: false, db: 'error', error: String(e && e.message || e) }, 500);
  }
}

/* ── 라우팅 ────────────────────────────────────────────── */
async function handleApi(request, env, url) {
  const path = url.pathname.slice('/api'.length) || '/';
  const method = request.method;

  if (path === '/health' && method === 'GET') return health(env);

  if (path === '/auth/guest' && method === 'POST') return guestLogin(request, env);

  if (path === '/me' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    return me(env, sess);
  }

  /* 진행상황 읽기/쓰기. 클라 저장본과 같은 모양으로 주고받는다. */
  if (path === '/state' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const st = await loadState(env, sess.account_id);
    if (!st) return json({ ok: false, error: 'no player' }, 404);
    return json({ ok: true, ...st, server_now: Date.now() });
  }

  if (path === '/state' && method === 'PUT') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = null; }
    const clean = sanitize(body && body.state);
    if (!clean.ok) return json({ ok: false, error: clean.error }, 400);
    /* 낙관적 잠금: 클라가 알고 있는 rev 와 서버 rev 가 다르면 다른 곳에서 먼저 저장한 것이다.
       덮어쓰지 않고 현재 상태를 돌려준다. 클라가 받아서 다시 판단한다. */
    const cur = await env.DB.prepare('SELECT rev FROM player WHERE account_id = ?1').bind(sess.account_id).first();
    if (!cur) return json({ ok: false, error: 'no player' }, 404);
    /* 격납고·뽑기·전투가 전부 서버 판정이 된 뒤로, 임의 상태 업로드를 열어 두면
       조작이 그쪽으로 새어 나간다. 그래서 '아직 한 번도 올린 적 없는 계정'의
       최초 이관에만 허용한다(브라우저에 있던 예전 저장본을 옮기는 용도). */
    if (cur.rev !== 0) return json({ ok: false, error: 'state upload is only allowed once (migration)' }, 403);
    if (typeof body.rev === 'number' && body.rev !== cur.rev) {
      const st = await loadState(env, sess.account_id);
      return json({ ok: false, error: 'rev mismatch', ...st, server_now: Date.now() }, 409);
    }
    const r = await saveState(env, sess.account_id, clean.state, Date.now());
    if (!r.ok) return json({ ok: false, error: r.error }, 500);
    await registerArena(env, sess.account_id, Date.now());   // 이관된 편성으로 다시 등록
    return json({ ok: true, rev: r.rev, wrote: r.wrote, server_now: Date.now() });
  }

  /* 뽑기 — 서버가 판정한다. 클라가 보낸 결과는 받지 않는다. */
  if (path === '/pull' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const r = await serverPull(env, sess.account_id, body && body.count, Date.now());
    if (!r.ok) return json({ ok: false, error: r.error, cores: r.cores }, r.status || 500);
    return json({ ok: true, results: r.results, rev: r.rev,
                  credits: r.credits, cores: r.cores, scrap: r.scrap, wrote: r.wrote });
  }

  /* 전투 — 상대 선택도 시드도 승패도 서버가 정한다. 클라는 재생만 한다. */
  if (path === '/battle/find' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await findMatch(env, sess.account_id, Date.now());
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status || 500);
  }
  if (path === '/battle/start' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await startBattle(env, sess.account_id, Date.now());
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status || 500);
  }

  /* 격납고 조작 — 비용 계산과 가능 여부 판단을 서버가 한다 */
  if (path === '/hangar' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const r = await hangarAction(env, sess.account_id, body, Date.now());
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status || 400);
  }

  /* ── 정식 계정 ───────────────────────────────────────
     승격은 새 계정을 만드는 게 아니라 지금 쓰던 계정에 로그인 수단을 붙이는 것이다.
     그래서 진행상황이 그대로 이어진다. */
  if (path === '/auth/register' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const { login_id, password } = body || {};
    const bad = checkCredentials(login_id, password);
    if (bad) return json({ ok: false, error: bad }, 400);

    const cur = await env.DB.prepare('SELECT login_id FROM account WHERE id = ?1').bind(sess.account_id).first();
    if (cur && cur.login_id) return json({ ok: false, error: '이미 정식 계정입니다' }, 400);

    const taken = await env.DB.prepare('SELECT id FROM account WHERE login_id = ?1').bind(login_id).first();
    if (taken) return json({ ok: false, error: '이미 쓰이는 아이디입니다' }, 409);

    const t0 = Date.now();
    const pw = await hashPassword(password);
    try {
      await env.DB.prepare('UPDATE account SET login_id = ?1, pw_hash = ?2 WHERE id = ?3')
        .bind(login_id, pw, sess.account_id).run();
    } catch (e) {
      // UNIQUE 충돌이 여기서 날 수도 있다(동시에 같은 아이디로 가입)
      return json({ ok: false, error: '이미 쓰이는 아이디입니다' }, 409);
    }
    return json({ ok: true, login_id, hash_ms: Date.now() - t0 });
  }

  if (path === '/auth/login' && method === 'POST') {
    let body; try { body = await request.json(); } catch { body = {}; }
    const { login_id, password } = body || {};
    if (typeof login_id !== 'string' || typeof password !== 'string')
      return json({ ok: false, error: '아이디와 비밀번호를 입력하세요' }, 400);

    const acc = await env.DB.prepare('SELECT id, pw_hash, status FROM account WHERE login_id = ?1')
      .bind(login_id).first();
    /* 아이디가 없을 때도 같은 문구를 돌려준다 — 어떤 아이디가 존재하는지 알려주지 않는다. */
    const FAIL = { ok: false, error: '아이디 또는 비밀번호가 맞지 않습니다' };
    if (!acc || !acc.pw_hash) return json(FAIL, 401);
    if (acc.status !== 'active') return json({ ok: false, error: '사용할 수 없는 계정입니다' }, 403);
    if (!await verifyPassword(password, acc.pw_hash)) return json(FAIL, 401);

    const now = Date.now();
    await env.DB.prepare('UPDATE account SET last_seen = ?1 WHERE id = ?2').bind(now, acc.id).run();
    const s = await newSession(env, acc.id, now);
    return json({ ok: true, account_id: acc.id, login_id, ...s });
  }

  if (path === '/auth/logout' && method === 'POST') {
    const h = request.headers.get('authorization') || '';
    const m = h.match(/^Bearer\s+([0-9a-f]{32,128})$/i);
    if (m) await env.DB.prepare('DELETE FROM session WHERE token = ?1').bind(m[1]).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: 'not found', path: url.pathname, method }, 404);
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

    return env.ASSETS.fetch(request);
  },
};
