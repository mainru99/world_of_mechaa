/* 난투 — 서버 판정. (2026-10-07 사용자 결정 · docs/plan/brawl-2026-10-07.md ④ · 이관 025)
 *
 *   GET  /api/brawl                         오늘(남은 대여 · 오늘의 대여 6기 · 첫 런 보상 남음) · 진행 중인 런 · 이번 주 내 기록
 *   GET  /api/brawl/rank                    이번 주 순위 50 + 내 자리
 *   POST /api/brawl { action:'start', rentals:[type…], deck:[type…] }     런 시작(대여는 장 수만큼 쓴다)
 *        { action:'act',   rev, actions:[a…] }                            상점 동작 여러 개를 한 번에(js/brawl.js act)
 *        { action:'fight', rev, actions?:[a…] }                           (동작을 마저 하고) 이 라운드 전투
 *        { action:'quit',  rev }                                          런을 여기서 끝낸다(그때 승수로 마감)
 *
 * 규칙은 전부 js/brawl.js — 서버는 받은 동작을 **같은 함수로 다시 돌려** 검증하고 저장만 한다. 클라가 보낸 런 상태는 믿지 않는다.
 * 상대는 같은 라운드의 저장된 보드(brawl_ghost · 내 것 · 이미 만난 것 제외) 중 최근 30 에서 하나, 없으면 봇 보드(js/brawl.js botRun).
 * 시드는 서버가 굴리고 응답에 싣는다 — 화면은 runBrawl({p, e, seed}) 로 같은 판을 재생한다.
 *
 * 보상은 **그날 첫 런**만(시작할 때 runs 가 0 이었던 런 · brawl_run.first). 두 번째부터는 연습 — 순위에는 들어간다.
 * 쓰기는 모두 brawl_run.rev 를 조건으로 건 한 번의 batch(트랜잭션)다. 뒤의 문장은 `changes() = 1` 로 앞 문장에 묶어,
 * rev 가 어긋나면(두 번 누름 · 다른 탭) 유령 · 보상 · 순위가 하나도 안 들어간다.
 *
 * 스위치 CONST.BRAWL.on 이 꺼져 있으면 GET 은 { on:false } 만, POST 는 403 'brawl off'.
 */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { runBrawl } from '../js/brawl-sim.js';
import { newRun, act, settle, teamOf, dailyRentals, rewardOf, synergiesOf, oddsOf, incomeOf,
         botRun, BOT_STYLES, h32 } from '../js/brawl.js';
import { dayOf } from '../js/raid.js';
import { weekOf } from '../js/trial.js';
import { goalOk, autoGoal } from '../js/mastery.js';
import { shardKey } from '../js/shop.js';

const err = (status, error, extra) => ({ ok: false, status, error, ...(extra || {}) });
const B = () => CONST.BRAWL || {};
const on = () => !!B().on;
const MAX_ACTIONS = 200;
const GHOST_PICK = 30;
const rnd32 = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/* 오늘 쓴 것 — 날짜가 바뀌었으면 0 으로 읽는다(자정에 지우는 일을 두지 않는다) */
function today(raw, now) {
  const d = dayOf(now), x = parse(raw, null);
  return x && x.d === d ? { d, runs: x.runs | 0, tickets: x.tickets | 0 } : { d, runs: 0, tickets: 0 };
}

async function loadPlayer(env, acc) {
  const p = await env.DB.prepare('SELECT nickname, level, items, m_goal, brawl FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return null;
  const rows = (await env.DB.prepare('SELECT type FROM robot WHERE account_id = ?1').bind(acc).all()).results || [];
  const owned = [...new Set(rows.map(r => r.type))].filter(t => ROBOT_TYPES[t] && !ROBOT_TYPES[t].story).sort();
  return { p, owned };
}
const loadRun = (env, acc) => env.DB.prepare('SELECT run, first, met, rev FROM brawl_run WHERE account_id = ?1').bind(acc).first();

/* 화면이 그대로 그릴 런 — 상태 + 보드 시너지 · 이번 상점 등급 몫 · 다음 수입 미리 보기 */
function runView(row) {
  if (!row) return null;
  const run = parse(row.run, null);
  if (!run) return null;
  return { rev: row.rev, first: !!row.first, run, syn: synergiesOf(run.board), odds: oddsOf(run), income: incomeOf(run) };
}

export async function brawlView(env, acc, now) {
  if (!on()) return { ok: true, on: false };
  const L = await loadPlayer(env, acc);
  if (!L) return err(404, 'no player');
  const t = today(L.p.brawl, now), wk = weekOf(now);
  const row = await loadRun(env, acc);
  const mine = await env.DB.prepare('SELECT best, lives, runs FROM brawl_week WHERE week = ?1 AND account_id = ?2').bind(wk, acc).first();
  return {
    ok: true, on: true, server_now: now, day: t.d, endsAt: (t.d + 1) * 86400000,
    offers: dailyRentals(t.d, L.owned),
    tickets: Math.max(0, B().rent.daily - t.tickets), runsToday: t.runs, rewardLeft: t.runs === 0,
    deckCap: B().deck, deckFrom: L.owned.filter(x => ROBOT_TYPES[x].rarity !== 'C'),
    run: runView(row),
    week: { week: wk, best: mine ? mine.best : null, lives: mine ? mine.lives : null, runs: mine ? mine.runs : 0 },
  };
}

export async function brawlRank(env, acc, now) {
  if (!on()) return { ok: true, on: false };
  const wk = weekOf(now);
  const top = (await env.DB.prepare(
    'SELECT account_id, nickname, best, lives, runs FROM brawl_week WHERE week = ?1 ORDER BY best DESC, lives DESC, updated_at ASC LIMIT 50')
    .bind(wk).all()).results || [];
  const me = await env.DB.prepare('SELECT best, lives, updated_at FROM brawl_week WHERE week = ?1 AND account_id = ?2').bind(wk, acc).first();
  let rank = null;
  if (me) {
    const above = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM brawl_week WHERE week = ?1 AND (best > ?2 OR (best = ?2 AND lives > ?3) OR (best = ?2 AND lives = ?3 AND updated_at < ?4))`)
      .bind(wk, me.best, me.lives, me.updated_at).first();
    rank = (above ? above.n : 0) + 1;
  }
  return { ok: true, on: true, week: wk, top: top.map((r, i) => ({ rank: i + 1, nickname: r.nickname, best: r.best, lives: r.lives, runs: r.runs, me: r.account_id === acc })),
           me: me ? { rank, best: me.best, lives: me.lives } : null };
}

/* ── 시작 ──────────────────────────────────────────────── */
async function start(env, acc, now, body) {
  const L = await loadPlayer(env, acc);
  if (!L) return err(404, 'no player');
  if (await loadRun(env, acc)) return err(409, 'run active');
  const t = today(L.p.brawl, now);
  const rentals = Array.isArray(body.rentals) ? body.rentals : [];
  const deck = body.deck == null ? null : (Array.isArray(body.deck) ? body.deck : 'bad');
  if (rentals.some(x => typeof x !== 'string') || new Set(rentals).size !== rentals.length) return err(400, 'bad rental');
  const offers = new Set(dailyRentals(t.d, L.owned));
  if (rentals.some(x => !offers.has(x))) return err(400, 'bad rental');
  if (rentals.length > B().rent.daily - t.tickets) return err(400, 'no tickets', { tickets: Math.max(0, B().rent.daily - t.tickets) });
  if (deck === 'bad' || (deck && (deck.some(x => typeof x !== 'string') || new Set(deck).size !== deck.length))) return err(400, 'bad deck');
  if (deck) {
    const have = new Set(L.owned);
    if (deck.some(x => !have.has(x) || ROBOT_TYPES[x].rarity === 'C')) return err(400, 'bad deck');
    if (deck.length + rentals.length > B().deck) return err(400, 'deck too big', { cap: B().deck });
  }
  const run = newRun({ seed: rnd32(), day: t.d, owned: L.owned, rentals, deck: deck || undefined });
  const first = t.runs === 0 ? 1 : 0;
  const next = JSON.stringify({ d: t.d, runs: t.runs + 1, tickets: t.tickets + rentals.length });
  let res;
  try {
    res = await env.DB.batch([
      env.DB.prepare('UPDATE player SET brawl = ?2, updated_at = ?3 WHERE account_id = ?1 AND brawl IS ?4').bind(acc, next, now, L.p.brawl),
      env.DB.prepare(`INSERT INTO brawl_run (account_id, run, first, met, rev, started_at, updated_at)
                      SELECT ?1, ?2, ?3, '[]', 0, ?4, ?4 WHERE changes() = 1`).bind(acc, JSON.stringify(run), first, now),
    ]);
  } catch { return err(409, 'run active'); }                     // 같은 계정이 동시에 시작 — PK 가 하나만 받는다
  if ((res[0]?.meta?.changes ?? 0) !== 1 || (res[1]?.meta?.changes ?? 0) !== 1) return err(409, 'state changed, retry');
  return { ok: true, run: runView({ run: JSON.stringify(run), first, rev: 0 }), tickets: B().rent.daily - t.tickets - rentals.length };
}

/* 받은 동작을 차례로 돌린다 — 하나라도 틀리면 아무것도 저장하지 않는다 */
function applyAll(run, actions) {
  if (actions == null) return { run, merged: [] };
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) return { error: 'bad actions' };
  const merged = [];
  for (let k = 0; k < actions.length; k++) {
    const r = act(run, actions[k]);
    if (r.error) return { error: r.error, at: k };
    run = r.run; if (r.merged) merged.push(...r.merged);
  }
  return { run, merged };
}

async function loadForWrite(env, acc, body) {
  const row = await loadRun(env, acc);
  if (!row) return { e: err(404, 'no run') };
  if (!Number.isInteger(body.rev) || body.rev !== row.rev) return { e: err(409, 'stale rev', { rev: row.rev }) };
  const run = parse(row.run, null);
  if (!run) return { e: err(500, 'bad run') };
  return { row, run };
}

async function doAct(env, acc, now, body) {
  const { e, row, run } = await loadForWrite(env, acc, body);
  if (e) return e;
  const A = applyAll(run, body.actions);
  if (A.error) return err(400, A.error, A.at != null ? { at: A.at } : undefined);
  const res = await env.DB.prepare('UPDATE brawl_run SET run = ?3, rev = rev + 1, updated_at = ?4 WHERE account_id = ?1 AND rev = ?2')
    .bind(acc, row.rev, JSON.stringify(A.run), now).run();
  if ((res.meta?.changes ?? 0) !== 1) return err(409, 'state changed, retry');
  return { ok: true, merged: A.merged, run: runView({ run: JSON.stringify(A.run), first: row.first, rev: row.rev + 1 }) };
}

/* 상대 — 같은 라운드의 다른 사람 보드(최근 GHOST_PICK 중 하나 · 만난 것 제외). 없으면 봇 */
async function pickGhost(env, acc, round, met) {
  const rows = (await env.DB.prepare(
    `SELECT id, nickname, board FROM brawl_ghost WHERE round = ?1 AND (account_id IS NULL OR account_id != ?2) ORDER BY id DESC LIMIT ?3`)
    .bind(round, acc, GHOST_PICK + met.length).all()).results || [];
  const seen = new Set(met);
  const cand = rows.filter(r => !seen.has(r.id)).slice(0, GHOST_PICK)
    .map(r => ({ id: r.id, nickname: r.nickname, board: parse(r.board, null) }))
    .filter(g => Array.isArray(g.board) && g.board.some(u => u && ROBOT_TYPES[u.type]));
  if (cand.length) return cand[rnd32() % cand.length];
  const styles = Object.keys(BOT_STYLES), s = rnd32();
  const bot = botRun({ seed: s, round, style: styles[s % styles.length] });
  return { id: null, nickname: '훈련 봇', bot: true, board: bot.board };
}

/* 끝난 런의 마감 — 보상(첫 런만) · 주간 순위. batch 에 이어 붙일 문장들을 돌려준다(앞 문장에 changes() 로 묶인다) */
function finishStmts(env, acc, now, L, run, first) {
  const out = [], reward = first ? rewardOf(run.wins, L.p.level) : null;
  let shardTo = null;
  if (reward) {
    if (reward.shard) shardTo = goalOk(L.p.m_goal, L.owned) ? L.p.m_goal : autoGoal(L.owned);
    const key = shardTo ? '$."' + shardKey(shardTo) + '"' : null;
    out.push(env.DB.prepare(
      `UPDATE player SET credits = credits + ?2, scrap = scrap + ?3, rcores = rcores + ?4,
              items = CASE WHEN ?5 IS NULL THEN items ELSE json_set(COALESCE(items, '{}'), ?5, COALESCE(json_extract(items, ?5), 0) + ?6) END,
              rev = rev + 1, updated_at = ?7
        WHERE account_id = ?1 AND changes() = 1`)
      .bind(acc, reward.cr, reward.sc, reward.refined, key, shardTo ? reward.shard : 0, now));
  }
  out.push(env.DB.prepare(
    `INSERT INTO brawl_week (week, account_id, nickname, best, lives, runs, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6 WHERE changes() = 1
     ON CONFLICT (week, account_id) DO UPDATE SET
       nickname = excluded.nickname, runs = runs + 1,
       updated_at = CASE WHEN excluded.best > best OR (excluded.best = best AND excluded.lives > lives) THEN excluded.updated_at ELSE updated_at END,
       lives = CASE WHEN excluded.best > best OR (excluded.best = best AND excluded.lives > lives) THEN excluded.lives ELSE lives END,
       best = MAX(best, excluded.best)`)
    .bind(weekOf(now), acc, L.p.nickname, run.wins, run.lives, now));
  return { stmts: out, reward: reward ? { ...reward, shard: shardTo ? reward.shard : 0, shardTo } : null };
}

async function fight(env, acc, now, body) {
  const { e, row, run: run0 } = await loadForWrite(env, acc, body);
  if (e) return e;
  const A = applyAll(run0, body.actions);
  if (A.error) return err(400, A.error, A.at != null ? { at: A.at } : undefined);
  const run = A.run;
  if (!run.board.some(Boolean)) return err(400, 'empty board');
  const L = await loadPlayer(env, acc);
  if (!L) return err(404, 'no player');
  const met = parse(row.met, []);
  const opp = await pickGhost(env, acc, run.round, met);
  const seed = rnd32();
  const p = teamOf(run.board), eTeam = teamOf(opp.board);
  const out = runBrawl({ p, e: eTeam, seed });
  const S = settle(run, out.win);
  const next = S.run, round = run.round;
  const metNext = opp.id != null ? [...met, opp.id].slice(-200) : met;

  const head = next.done
    ? env.DB.prepare('DELETE FROM brawl_run WHERE account_id = ?1 AND rev = ?2').bind(acc, row.rev)
    : env.DB.prepare('UPDATE brawl_run SET run = ?3, met = ?4, rev = rev + 1, updated_at = ?5 WHERE account_id = ?1 AND rev = ?2')
        .bind(acc, row.rev, JSON.stringify(next), JSON.stringify(metNext), now);
  const ghost = env.DB.prepare(
    `INSERT INTO brawl_ghost (round, account_id, nickname, board, wins, lives, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() = 1`)
    .bind(round, acc, L.p.nickname, JSON.stringify(run.board), run.wins, run.lives, now);
  const fin = next.done ? finishStmts(env, acc, now, L, next, !!row.first) : { stmts: [], reward: null };
  const res = await env.DB.batch([head, ghost, ...fin.stmts]);
  if ((res[0]?.meta?.changes ?? 0) !== 1) return err(409, 'state changed, retry');

  return {
    ok: true, seed, round, win: out.win,
    me: { board: run.board, team: p },
    opponent: { nickname: opp.nickname, bot: !!opp.bot, board: opp.board, team: eTeam },
    events: out.events,
    lost: S.lost, income: S.income, merged: A.merged,
    done: !!next.done, reward: fin.reward,
    run: next.done ? null : runView({ run: JSON.stringify(next), first: row.first, rev: row.rev + 1 }),
    result: next.done ? { wins: next.wins, losses: next.losses, lives: next.lives, rounds: next.round, hist: next.hist, first: !!row.first } : null,
  };
}

async function quit(env, acc, now, body) {
  const { e, row, run } = await loadForWrite(env, acc, body);
  if (e) return e;
  const L = await loadPlayer(env, acc);
  if (!L) return err(404, 'no player');
  const fin = finishStmts(env, acc, now, L, run, !!row.first);
  const res = await env.DB.batch([
    env.DB.prepare('DELETE FROM brawl_run WHERE account_id = ?1 AND rev = ?2').bind(acc, row.rev), ...fin.stmts]);
  if ((res[0]?.meta?.changes ?? 0) !== 1) return err(409, 'state changed, retry');
  return { ok: true, done: true, reward: fin.reward,
           result: { wins: run.wins, losses: run.losses, lives: run.lives, rounds: run.round, hist: run.hist, first: !!row.first, quit: true } };
}

export async function brawlRun(env, acc, now, body) {
  if (!on()) return err(403, 'brawl off');
  const a = body && body.action;
  if (a === 'start') return start(env, acc, now, body);
  if (a === 'act') return doAct(env, acc, now, body);
  if (a === 'fight') return fight(env, acc, now, body);
  if (a === 'quit') return quit(env, acc, now, body);
  return err(400, 'bad action');
}

/* 청소(server/cleanup.js) — 14일 넘은 유령 · 8주 넘은 주간 기록. 한 번에 cap 행까지 */
export async function brawlCleanup(env, now, cap) {
  const g = await env.DB.prepare(
    'DELETE FROM brawl_ghost WHERE id IN (SELECT id FROM brawl_ghost WHERE created_at < ?1 LIMIT ?2)').bind(now - 14 * 86400000, cap).run();
  const w = await env.DB.prepare(
    'DELETE FROM brawl_week WHERE rowid IN (SELECT rowid FROM brawl_week WHERE week < ?1 LIMIT ?2)').bind(weekOf(now) - 8, cap).run();
  return { ghosts: g.meta?.changes ?? 0, weeks: w.meta?.changes ?? 0 };
}

export const _brawlInternals = { today, h32 };
