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
import { sanitize, loadState, saveState, migrationOpen, noteMigration } from './state.js';
import { ranking, refreshRanks } from './ranking.js';
import { cleanup } from './cleanup.js';

/* 청소는 하루 한 번만 돈다. 전투 기록 정리가 표 전체를 훑기 때문이다.
   wrangler.jsonc 의 두 번째 크론과 문자열이 정확히 같아야 한다. */
const DAILY_CRON = '17 4 * * *';
import { serverPull } from './pull.js';
import { findMatch, startBattle } from './battle.js';
import { hangarAction } from './hangar.js';
import { trialView, trialRun } from './trial.js';
import { raidView, raidRun } from './raid.js';
import { frontState, frontRun } from './front.js';
import { codexRun, codexGet } from './codex.js';
import { shopView, shopRun } from './shop.js';
import { refineRun, circuitRun } from './refine.js';
import { salvageView, salvageRun } from './salvage.js';
import { brawlView, brawlRank, brawlRun } from './brawl.js';
import { sendExped, claimExped } from './expedition.js';
import { territoryView, attackNode, claimTerritory } from './territory.js';
import { registerArena, balanceVersion, migrateArena } from './arena.js';
import { hashPassword, verifyPassword, checkCredentials,
         attemptKeys, checkBlocked, noteFailure, clearAttempts } from './auth.js';

/* 시작 기체는 커먼에서 하나. 클라의 freshState() 와 같은 규칙이다.
   시작 재화(크레딧 600·코어 12·스크랩 30)는 schema.sql 의 DEFAULT 에 있다 —
   두 군데 적어 두면 반드시 어긋나므로 여기서는 넘기지 않는다. */
const COMMON_IDS = Object.values(ROBOT_TYPES).filter(r => r.rarity === 'C' && !r.story).map(r => r.id);   // 스토리 기체로 시작하지 않는다

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
/* last_seen 을 다시 찍는 주기. 매 요청 쓰면 비싸고, 안 쓰면 값이 거짓이 된다. */
const SEEN_THROTTLE_MS = DAY_MS;

async function auth(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+([0-9a-f]{32,128})$/i);
  if (!m) return null;
  const row = await env.DB
    .prepare(`SELECT s.token, s.account_id, s.expires_at, a.status, a.last_seen
                FROM session s JOIN account a ON a.id = s.account_id
               WHERE s.token = ?1`)
    .bind(m[1]).first();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) return null;
  if (row.status !== 'active') return null;

  /* '마지막 접속'을 실제로 갱신한다.
     예전에는 로그인할 때만 찍었다. 세션이 90일이라, 한 번 로그인하고 두 달 넘게
     매일 노는 사람도 last_seen 은 첫날에 멈춰 있었다. 그 값을 보고 미접속 계정을
     지우는 청소가 붙었으므로, 그대로 두면 **한창 하는 사람의 계정을 지운다.**
     매 요청 쓰면 비용이 크니 하루에 한 번만 쓴다 — 계정당 하루 1행이면 무시할 만하다. */
  if (!row.last_seen || now - row.last_seen > SEEN_THROTTLE_MS) {
    await env.DB.prepare('UPDATE account SET last_seen = ?1 WHERE id = ?2')
      .bind(now, row.account_id).run();
    row.last_seen = now;
  }
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

/* 보이는 이름을 바꾼다.
   `player.nickname` 이 정본이고, `arena_entry` 와 `territory` 는 **조인 없이 읽으려고
   복사해 둔 표시용**이다. 세 곳을 같이 고치지 않으면 한 곳만 새 이름이 된다.

   게스트를 정식 계정으로 바꿀 때 이걸 안 했다. 그래서 moonrabbit09 로 가입하고도
   랭킹·아레나·점령 지도에 GUEST-0015 로 남아 있었다(2026-09-11 실제 발생).
   `login_id` 는 영문·숫자·밑줄 4~20자라 `GUEST-0001` 꼴과 겹치지 않고,
   `account.login_id` 가 UNIQUE 라 닉네임도 따라서 유일하다. */
async function renameTo(env, accountId, name) {
  await env.DB.batch([
    env.DB.prepare('UPDATE player SET nickname = ?1 WHERE account_id = ?2').bind(name, accountId),
    env.DB.prepare('UPDATE arena_entry SET nickname = ?1 WHERE account_id = ?2').bind(name, accountId),
    env.DB.prepare('UPDATE territory SET owner_name = ?1 WHERE owner_id = ?2').bind(name, accountId),
  ]);
}

/* 기체·파츠를 가리키는 클라이언트 식별자.
   격납고 API 는 전부 이 uid 로 행을 찾는다(robot.uid / part.uid). 서버가 만든 행에
   uid 가 없으면 클라가 그 기체를 **가리킬 수가 없다** — 장착도 정비도 레벨업도
   'robot not found' 가 된다. 그래서 서버가 행을 만들 때 반드시 함께 만든다. */
function newUid(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

/* uid 가 비어 있는 옛 기체를 채운다.
   시작 기체를 uid 없이 만들던 시절의 계정이 남아 있다. 그때는 클라가 자기 저장본을
   통째로 올려(이관) 그 과정에서 uid 가 맞춰졌는데, 이관 문을 닫은 뒤로는 그 길이 없어져
   **새로 만들어진 계정이 전부 격납고를 못 쓰는 상태**가 됐다. 접속할 때 조용히 메운다. */
async function ensureRobotUids(env, accountId, now) {
  const rows = (await env.DB.prepare(
    "SELECT id FROM robot WHERE account_id = ?1 AND COALESCE(uid, '') = ''").bind(accountId).all()).results || [];
  if (!rows.length) return;
  await env.DB.batch(rows.map(r => env.DB
    .prepare('UPDATE robot SET uid = ?1 WHERE id = ?2').bind(newUid('r'), r.id)));
  await env.DB.prepare('UPDATE player SET rev = rev + 1, updated_at = ?1 WHERE account_id = ?2')
    .bind(now, accountId).run();
}

/* 기체가 하나도 없으면 시작 기체를 만들어 준다.
   계정 생성이 중간에 끊긴 경우를 다음 접속 때 스스로 복구한다. */
async function ensureStarter(env, accountId, now) {
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM robot WHERE account_id = ?1').bind(accountId).first();
  if (cnt && cnt.n > 0) return ensureRobotUids(env, accountId, now);
  const type = pick(COMMON_IDS);
  const r = await env.DB
    .prepare('INSERT INTO robot (account_id, type, level, exp, fat, fat_at, uid, created_at) VALUES (?1,?2,1,0,0,?3,?4,?3)')
    .bind(accountId, type, now, newUid('r')).run();
  /* 시작 기체는 편성 1번이자 이번에 나갈 기체다. squad1 이 비어 있으면
     클라가 '편성 없음'으로 읽어 아무것도 못 내보낸다. */
  await env.DB.prepare('UPDATE player SET sel_robot = ?1, squad1 = ?1, updated_at = ?2 WHERE account_id = ?3')
    .bind(r.meta.last_row_id, now, accountId).run();
}

/* 편성이 비어 있으면 채운다. 006 이전 계정과, 편성 기체를 잃은 경우를 스스로 복구한다. */
async function ensureSquad(env, accountId, now) {
  const p = await env.DB.prepare('SELECT squad1, squad2, sel_robot FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!p || p.squad1) return;
  const r = await env.DB.prepare('SELECT id FROM robot WHERE account_id = ?1 ORDER BY id LIMIT 1')
    .bind(accountId).first();
  if (!r) return;
  await env.DB.prepare('UPDATE player SET squad1 = ?1, sel_robot = COALESCE(sel_robot, ?1), updated_at = ?2 WHERE account_id = ?3')
    .bind(r.id, now, accountId).run();
}

/* 현재 계정 상태. 클라가 서버 상태를 확인하는 용도. */
async function me(env, sess) {
  const now = Date.now();
  await ensureStarter(env, sess.account_id, now);   // 반쪽 계정 자가 복구
  await ensureSquad(env, sess.account_id, now);    // 편성이 비어 있으면 채운다

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
    if(st.error)return json(st,st.status||500);
    return json({ ok: true, ...st, server_now: Date.now() });
  }

  if (path === '/state' && method === 'PUT') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    /* 문이 닫혀 있으면 아무것도 받지 않는다. 상한만으로는 '만렙 계정 심기'를 못 막는다. */
    if (!(await migrationOpen(env)))
      return json({ ok: false, error: 'migration is closed' }, 403);
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
    const now = Date.now();
    const r = await saveState(env, sess.account_id, clean.state, now);
    if (!r.ok) return json({ ok: false, error: r.error }, 500);
    await registerArena(env, sess.account_id, now);          // 이관된 편성으로 다시 등록
    await noteMigration(env, sess.account_id, clean.clamped, now);
    if (clean.clamped.length) console.log('migration clamped', sess.account_id, clean.clamped.slice(0, 10));
    return json({ ok: true, rev: r.rev, wrote: r.wrote, clamped: clean.clamped, server_now: now });
  }

  /* 뽑기 — 서버가 판정한다. 클라가 보낸 결과는 받지 않는다. */
  if (path === '/pull' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    /* cur 은 창구(코어/크레딧)다. 값 검증은 serverPull 이 한다 — 모르는 값이면 코어로 떨어진다. */
    const r = await serverPull(env, sess.account_id, body && body.count, Date.now(), body && body.cur);
    if (!r.ok) return json({ ok: false, error: r.error, cores: r.cores, credits: r.credits, rcores: r.rcores }, r.status || 500);
    return json({ ok: true, cur: r.cur, spent: r.spent, results: r.results, rev: r.rev,
                  credits: r.credits, cores: r.cores, rcores: r.rcores, scrap: r.scrap, wrote: r.wrote });
  }

  /* 전투 — 상대 선택도 시드도 승패도 서버가 정한다. 클라는 재생만 한다. */
  if (path === '/battle/find' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    /* 본문으로 모드를 받는다. { mode:'hunt', tier:'BOSS' } 면 토벌, 없으면 아레나. */
    let body; try { body = await request.json(); } catch { body = null; }
    const r = await findMatch(env, sess.account_id, Date.now(), body);
    /* 실패해도 need/have 같은 부가 정보를 그대로 넘긴다 — 클라가 '얼마가 모자란지' 를 보여 준다 */
    if (r.ok) return json(r);
    const { status, ...rest } = r;
    return json(rest, status || 500);
  }
  if (path === '/battle/start' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    /* 본문으로 전술을 받는다. { tactic:'rush' } 처럼. 없거나 모르는 값이면 균형이다. */
    let sbody; try { sbody = await request.json(); } catch { sbody = null; }
    const r = await startBattle(env, sess.account_id, Date.now(), sbody);
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status || 500);
  }

  /* 전선. 조회는 GET, 도전은 POST.
     POST 가 받는 것은 **칸 id 하나**뿐이다 — 무엇으로 싸울지·시드·방어선은 서버가 정한다.
     열린 칸인지도 서버가 진행 문자열을 읽어 확인한다(클라 판단을 믿지 않는다). */
  if (path === '/front' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await frontState(env, sess.account_id);
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/front' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let fbody; try { fbody = await request.json(); } catch { fbody = {}; }
    const r = await frontRun(env, sess.account_id, fbody, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  /* 도감. 보는 것은 /api/state 로 이미 온다(도감 원본 + 기체·파츠). 여기는 **바꾸는 것**만 —
     보상 받기와 칭호 달기. 무엇을 받을 수 있는지는 서버가 js/codex.js 로 다시 센다. */
  /* 상점 — 진열 보기(GET) · 사기 / 새로 굴리기 / 조각 조립(POST). 값은 서버가 js/shop.js 로 다시 센다. */
  if (path === '/shop' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await shopView(env, sess.account_id, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/shop' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let sbody; try { sbody = await request.json(); } catch { sbody = {}; }
    const r = await shopRun(env, sess.account_id, Date.now(), sbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  /* 정제 코어(023) — 코어 10개 → 1개. 코어 서킷 — 별 찍기 · 비우기(정제 코어 1개). 화면은 UI 개편 뒤 */
  if (path === '/refine' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let rbody; try { rbody = await request.json(); } catch { rbody = {}; }
    const r = await refineRun(env, sess.account_id, Date.now(), rbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/circuit' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let cbody; try { cbody = await request.json(); } catch { cbody = {}; }
    const r = await circuitRun(env, sess.account_id, Date.now(), cbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  /* 조각 회수 작전(023) — 하루 두 번 · 개발 목표의 조각. 보기(GET) · 한 판(POST) */
  if (path === '/salvage' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await salvageView(env, sess.account_id, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/salvage' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let vbody; try { vbody = await request.json(); } catch { vbody = {}; }
    const r = await salvageRun(env, sess.account_id, Date.now(), vbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  /* 난투(025) — 보기 · 주간 순위(GET) · 시작 · 동작 · 전투 · 포기(POST { action }). 스위치 CONST.BRAWL.on */
  if (path === '/brawl' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await brawlView(env, sess.account_id, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/brawl/rank' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await brawlRank(env, sess.account_id, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }
  if (path === '/brawl' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let bbody; try { bbody = await request.json(); } catch { bbody = {}; }
    const r = await brawlRun(env, sess.account_id, Date.now(), bbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  if (path === '/codex' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await codexGet(env, sess.account_id));
  }
  if (path === '/codex' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let cbody; try { cbody = await request.json(); } catch { cbody = {}; }
    const r = await codexRun(env, sess.account_id, Date.now(), cbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  /* 랭킹 — 순위는 크론이 미리 계산해 둔다. 여기서 세면 하위권이 전원을 읽는다. */
  /* 주간 시련. 읽기와 도전 둘 다 세션이 필요하다 —
     순위표에 내 줄을 표시하고, 도전은 내 기체를 읽어야 하기 때문이다. */
  if (path === '/trial' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await trialView(env, sess.account_id, Date.now()));
  }
  if (path === '/trial' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await trialRun(env, sess.account_id, Date.now());
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  /* 보스 레이드. 조회는 GET, 도전은 POST.
     도전 요청에 실리는 것은 편성 두 기의 **자리와 전술**뿐이다(2026-09-21 합동전) —
     몇 번째인지, 시드가 무엇인지, 무엇과 싸우는지는 전부 서버가 정한다. */
  if (path === '/raid' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await raidView(env, sess.account_id, Date.now()));
  }
  if (path === '/raid' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    /* 본문은 합동전 편성뿐이다 — { order:[uid,uid], tactics:{uid:전술} }. 서버가 걸러서 받는다 */
    let rbody; try { rbody = await request.json(); } catch { rbody = null; }
    const r = await raidRun(env, sess.account_id, Date.now(), rbody);
    return json(r, r.ok ? 200 : (r.status || 400));
  }

  if (path === '/ranking' && method === 'GET') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    const r = await ranking(env, sess.account_id);
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

  /* ── 원정 ────────────────────────────────────────────
     보낼 때와 받을 때 두 번만 부른다. 남은 시간은 클라가 /api/state 로 받은
     endsAt(서버 시각)으로 계산하므로, 진행 상황을 물으러 다시 오지 않는다. */
  if (path === '/expedition' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const now = Date.now();
    let r;
    if (body.action === 'send') {
      r = await sendExped(env, sess.account_id, now, body.robotUid, body.tier);
    } else if (body.action === 'claim') {
      /* 보상 난수는 서버가 만든다 — 클라 난수를 받으면 좋은 결과가 나올 때까지 다시 부를 수 있다. */
      let seq = 0;
      r = await claimExped(env, sess.account_id, now,
                           () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
                           () => 'x' + now.toString(36) + (seq++).toString(36));
    } else {
      r = { ok: false, status: 400, error: 'unknown action' };
    }
    return r.ok ? json(r) : json({ ok: false, error: r.error }, r.status || 400);
  }


  /* ── 점령전 ──────────────────────────────────────────
     요청 셋뿐이다. 지도 보기 / 한 칸 치기 / 수입 받기.
     한 칸의 방어선 전부를 attack 한 번에서 판정하고, 재생 자료를 함께 내려보낸다 —
     방어선마다 왕복하면 한 칸에 요청을 네 번 쓴다(요청 수가 곧 무료 한도다). */
  if (path === '/territory' && method === 'POST') {
    const sess = await auth(request, env);
    if (!sess) return json({ ok: false, error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const now = Date.now();
    let r;
    if (body.action === 'view')        r = await territoryView(env, sess.account_id, now);
    else if (body.action === 'attack') r = await attackNode(env, sess.account_id, now, body.node, body.raid);
    else if (body.action === 'claim')  r = await claimTerritory(env, sess.account_id, now);
    else r = { ok: false, status: 400, error: 'unknown action' };
    /* 보호 거절에는 남은 시각과 가진 코어를 함께 실어 보낸다 —
       클라가 '몇 분 남았고, 강행하려면 코어가 몇 개 필요한지'를 그 자리에서 보여 준다. */
    return r.ok ? json(r)
                : json({ ok: false, error: r.error, protectUntil: r.protectUntil,
                         cores: r.cores, minLv: r.minLv, myLv: r.myLv }, r.status || 400);
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

    /* 여기에도 시도 제한을 건다. 중복 검사가 해시보다 앞에 있어 '이 아이디가 있는가'를
       아주 싸게 물어볼 수 있다 — 계정 하나만 있으면 아이디를 마음껏 훑을 수 있었다.
       로그인과 같은 표를 쓰되 열쇠를 나눠, 가입 실패가 로그인 잠금에 섞이지 않게 한다. */
    const rip = request.headers.get('cf-connecting-ip') || '';
    const rkeys = attemptKeys('reg:' + sess.account_id, rip);
    const rwait = await checkBlocked(env, rkeys, Date.now());
    if (rwait) return json({ ok: false, error: `시도가 너무 많습니다. ${Math.ceil(rwait / 60)}분 뒤에 다시 시도하세요`, retry_after: rwait }, 429);

    const taken = await env.DB.prepare('SELECT id FROM account WHERE login_id = ?1').bind(login_id).first();
    if (taken) {
      await noteFailure(env, rkeys, Date.now());
      return json({ ok: false, error: '이미 쓰이는 아이디입니다' }, 409);
    }

    const pw = await hashPassword(password);
    try {
      await env.DB.prepare('UPDATE account SET login_id = ?1, pw_hash = ?2 WHERE id = ?3')
        .bind(login_id, pw, sess.account_id).run();
    } catch (e) {
      // UNIQUE 충돌이 여기서 날 수도 있다(동시에 같은 아이디로 가입)
      return json({ ok: false, error: '이미 쓰이는 아이디입니다' }, 409);
    }
    await clearAttempts(env, rkeys);          // 성공했으면 기록을 지운다
    await renameTo(env, sess.account_id, login_id);
    return json({ ok: true, login_id });
  }

  if (path === '/auth/login' && method === 'POST') {
    let body; try { body = await request.json(); } catch { body = {}; }
    const { login_id, password } = body || {};
    if (typeof login_id !== 'string' || typeof password !== 'string')
      return json({ ok: false, error: '아이디와 비밀번호를 입력하세요' }, 400);

    const now = Date.now();
    const ip = request.headers.get('cf-connecting-ip') || '';
    const keys = attemptKeys(login_id, ip);

    /* 실패가 쌓였으면 비밀번호를 확인하기도 전에 막는다.
       PBKDF2 를 돌리지 않으므로 잠긴 뒤에는 CPU 도 쓰지 않는다. */
    const wait = await checkBlocked(env, keys, now);
    if (wait) return json({ ok: false, error: `시도가 너무 많습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요`, retry_after: wait }, 429);

    const acc = await env.DB.prepare('SELECT id, pw_hash, status FROM account WHERE login_id = ?1')
      .bind(login_id).first();
    /* 아이디가 없을 때도 같은 문구를 돌려준다 — 어떤 아이디가 존재하는지 알려주지 않는다. */
    const FAIL = { ok: false, error: '아이디 또는 비밀번호가 맞지 않습니다' };
    if (!acc || !acc.pw_hash) { await noteFailure(env, keys, now); return json(FAIL, 401); }
    if (acc.status !== 'active') return json({ ok: false, error: '사용할 수 없는 계정입니다' }, 403);
    if (!await verifyPassword(password, acc.pw_hash)) { await noteFailure(env, keys, now); return json(FAIL, 401); }

    await clearAttempts(env, keys);          // 성공했으면 기록을 지운다
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

/* 정적 파일에 보안 헤더를 붙인다.
   CSP 는 인라인 스크립트를 막지는 못한다 — 화면 곳곳이 onclick="ROWAR.x()" 라
   'unsafe-inline' 없이는 게임이 안 돈다. 그래도 붙이는 값은 다음을 막아 준다.
     connect-src 'self'  스크립트가 끼어들어도 **다른 서버로 보낼 수 없다**
                         (세션 토큰이 localStorage 에 있으므로 이게 핵심이다)
     default-src 'self'  외부에서 무엇도 불러오지 않는다
     object-src 'none'   플러그인 삽입을 막는다
     base-uri 'none'     <base> 로 상대 경로를 통째로 가로채는 것을 막는다
     frame-ancestors     다른 사이트가 이 게임을 프레임에 넣는 것(클릭재킹)을 막는다 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function withSecurityHeaders(res) {
  const h = new Headers(res.headers);
  h.set('content-security-policy', CSP);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  h.set('x-frame-options', 'DENY');
  h.set('permissions-policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
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

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  /* 주기 작업. wrangler.jsonc 의 triggers.crons 가 부른다.
     여기서 도는 것은 사용자를 기다리게 하지 않으므로, 무거운 집계는 전부 이쪽으로 민다. */
  async scheduled(event, env) {
    /* waitUntil 로 던져 두지 않고 그냥 기다린다. 크론은 사용자를 기다리게 하지 않으므로
       늦어도 상관없고, 실패가 크론 실행 기록에 그대로 남아야 알아챌 수 있다. */
    const now = Date.now();
    console.log('ranks refreshed', JSON.stringify(await refreshRanks(env, now)));
    /* 밸런스를 고쳐 배포하면 등록된 방어 스냅샷이 전부 옛 버전이 된다.
       매칭 쪽은 그 자리에서 다시 계산해 넘기지만, power 컬럼은 옛 값이라
       ±15% 창이 어긋난다. 여기서 표를 훑어 새 값으로 맞춘다. */
    console.log('arena migrated', JSON.stringify(await migrateArena(env, now)));
    if (event.cron === DAILY_CRON) {
      console.log('cleanup', JSON.stringify(await cleanup(env, now)));
    }
  },
};
